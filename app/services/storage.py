import logging
import mimetypes
import uuid
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import boto3
from botocore.client import Config as BotoConfig
from botocore.exceptions import ClientError

from app.core.config import settings

ALLOWED_IMAGE_CONTENT_TYPES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
}
ALLOWED_IMAGE_EXTENSIONS = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}
ALLOWED_ENTITY_TYPES = {
    "material",
    "delivery_option",
    "order",
    "vehicle",
    "quarry",
    "equipment_listing",
    "water_point",
}
UPLOAD_CORS_CONFIGURATION = {
    "CORSRules": [
        {
            "AllowedHeaders": ["*"],
            "AllowedMethods": ["PUT", "POST", "GET", "HEAD", "DELETE"],
            "AllowedOrigins": ["*"],
            "ExposeHeaders": ["ETag", "x-amz-request-id"],
            "MaxAgeSeconds": 3600,
        }
    ]
}
logger = logging.getLogger(__name__)
_BUCKET_CORS_UPDATE_UNSUPPORTED = False


class StorageNotConfiguredError(RuntimeError):
    pass


class StorageValidationError(ValueError):
    pass


def _slugify_file_name(file_name: str) -> str:
    sanitized = "".join(ch if ch.isalnum() or ch in {".", "-", "_"} else "-" for ch in file_name.lower())
    return sanitized.strip("-") or "file"


def _join_url(base: str, path: str) -> str:
    return f"{base.rstrip('/')}/{path.lstrip('/')}"


def normalize_public_url(public_url: str | None) -> str | None:
    if not public_url:
        return public_url

    target_base_url = settings.s3_public_base_url.rstrip("/")
    if not target_base_url:
        return public_url

    parsed_public_url = urlsplit(public_url)
    if not parsed_public_url.netloc or "nip.io" not in parsed_public_url.netloc:
        return public_url

    parsed_target_base_url = urlsplit(target_base_url)
    if not parsed_target_base_url.netloc:
        return public_url

    return urlunsplit(
        (
            parsed_target_base_url.scheme or parsed_public_url.scheme,
            parsed_target_base_url.netloc,
            parsed_public_url.path,
            parsed_public_url.query,
            parsed_public_url.fragment,
        )
    )


class S3StorageService:
    def __init__(self) -> None:
        if not settings.S3_ENABLED:
            raise StorageNotConfiguredError("S3 storage is disabled")
        if not settings.S3_ENDPOINT or not settings.S3_ACCESS_KEY or not settings.S3_SECRET_KEY:
            raise StorageNotConfiguredError("S3 storage is not fully configured")

        self.bucket = settings.S3_BUCKET
        self.prefix = settings.S3_PREFIX.strip("/")
        self.public_base_url = settings.s3_public_base_url
        self._external_upload_base_url = (settings.S3_PRESIGN_ENDPOINT or settings.s3_public_base_url or "").rstrip("/")
        # Public asset URLs and presigned upload URLs may need different
        # external bases when S3 is published behind a proxy prefix.
        self._external_public_base_url = (
            settings.s3_public_base_url
            or settings.S3_PRESIGN_ENDPOINT
            or settings.S3_ENDPOINT
            or ""
        ).rstrip("/")
        self._client = boto3.client(
            "s3",
            endpoint_url=settings.S3_ENDPOINT,
            region_name=settings.S3_REGION,
            aws_access_key_id=settings.S3_ACCESS_KEY,
            aws_secret_access_key=settings.S3_SECRET_KEY,
            use_ssl=settings.S3_USE_SSL,
            config=BotoConfig(signature_version="s3v4", s3={"addressing_style": "path"}),
        )
        # Browser uploads must use a publicly reachable endpoint. Prefer the
        # dedicated presign endpoint, then the external public base URL, and
        # only fall back to the internal S3 endpoint for non-browser setups.
        presign_endpoint = settings.S3_PRESIGN_ENDPOINT or settings.s3_public_base_url or settings.S3_ENDPOINT
        self._presign_client = boto3.client(
            "s3",
            endpoint_url=presign_endpoint,
            region_name=settings.S3_REGION,
            aws_access_key_id=settings.S3_ACCESS_KEY,
            aws_secret_access_key=settings.S3_SECRET_KEY,
            use_ssl=presign_endpoint.startswith("https://"),
            config=BotoConfig(signature_version="s3v4", s3={"addressing_style": "path"}),
        )
        self._ensure_bucket_cors()

    def _ensure_bucket_cors(self) -> None:
        try:
            self._client.head_bucket(Bucket=self.bucket)
        except ClientError as exc:
            error_code = exc.response.get("Error", {}).get("Code", "")
            if error_code not in {"404", "NoSuchBucket", "NotFound"}:
                raise
            self._client.create_bucket(Bucket=self.bucket)

        current_rules = None
        try:
            current_rules = self._client.get_bucket_cors(Bucket=self.bucket).get("CORSRules")
        except ClientError as exc:
            error_code = exc.response.get("Error", {}).get("Code", "")
            if error_code not in {"NoSuchCORSConfiguration", "NoSuchBucket", "NotFound"}:
                logger.warning("Unable to read bucket CORS for %s: %s", self.bucket, exc)

        global _BUCKET_CORS_UPDATE_UNSUPPORTED

        if current_rules == UPLOAD_CORS_CONFIGURATION["CORSRules"] or _BUCKET_CORS_UPDATE_UNSUPPORTED:
            return

        try:
            self._client.put_bucket_cors(
                Bucket=self.bucket,
                CORSConfiguration=UPLOAD_CORS_CONFIGURATION,
            )
        except ClientError as exc:
            error_code = exc.response.get("Error", {}).get("Code", "")
            if error_code == "NotImplemented":
                _BUCKET_CORS_UPDATE_UNSUPPORTED = True
                logger.info(
                    "Bucket CORS update is unsupported by this S3 endpoint for %s; using proxy CORS headers",
                    self.bucket,
                )
                return
            logger.warning("Unable to update bucket CORS for %s: %s", self.bucket, exc)

    def assert_supported_image(self, file_name: str, content_type: str, file_size: int) -> None:
        suffix = Path(file_name).suffix.lower()
        expected_content_type = ALLOWED_IMAGE_EXTENSIONS.get(suffix)
        if expected_content_type is None:
            raise StorageValidationError("Unsupported file extension")
        if content_type not in ALLOWED_IMAGE_CONTENT_TYPES:
            raise StorageValidationError("Unsupported content type")
        if expected_content_type != content_type and not (
            expected_content_type == "image/jpeg" and content_type == "image/jpg"
        ):
            raise StorageValidationError("File extension does not match content type")
        if file_size > settings.MEDIA_MAX_FILE_SIZE_BYTES:
            raise StorageValidationError("File exceeds the 10 MB limit")

    def assert_supported_entity_type(self, entity_type: str) -> None:
        if entity_type not in ALLOWED_ENTITY_TYPES:
            raise StorageValidationError("Unsupported entity type")

    def build_object_key(self, entity_type: str, file_name: str) -> str:
        suffix = Path(file_name).suffix.lower()
        safe_name = _slugify_file_name(Path(file_name).stem)
        object_name = f"{safe_name}-{uuid.uuid4().hex}{suffix}"
        if self.prefix:
            return f"{self.prefix}/{entity_type}s/{object_name}"
        return f"{entity_type}s/{object_name}"

    def build_public_url(self, object_key: str) -> str:
        path = f"{self.bucket}/{object_key}"
        if self._external_public_base_url:
            return _join_url(self._external_public_base_url, path)
        return _join_url(settings.S3_ENDPOINT.rstrip('/'), path)

    def _externalize_presigned_url(self, presigned_url: str) -> str:
        if not self._external_upload_base_url:
            return presigned_url

        parsed = urlsplit(presigned_url)
        if not parsed.netloc:
            return presigned_url

        external_base = urlsplit(self._external_upload_base_url)
        internal_base = urlsplit((settings.S3_ENDPOINT or "").rstrip("/"))
        if parsed.netloc != internal_base.netloc:
            return presigned_url

        return urlunsplit(
            (
                external_base.scheme or parsed.scheme,
                external_base.netloc or parsed.netloc,
                parsed.path,
                parsed.query,
                parsed.fragment,
            )
        )

    def generate_presigned_put(self, object_key: str, content_type: str) -> str:
        presigned_url = self._presign_client.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": self.bucket,
                "Key": object_key,
                "ContentType": content_type,
            },
            ExpiresIn=3600,
        )
        return self._externalize_presigned_url(presigned_url)

    def generate_presigned_get(self, object_key: str, expires_in: int | None = None) -> str:
        return self._presign_client.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": self.bucket,
                "Key": object_key,
            },
            ExpiresIn=expires_in or settings.S3_PRESIGN_TTL_SECONDS,
        )

    def delete_object(self, object_key: str) -> None:
        self._client.delete_object(Bucket=self.bucket, Key=object_key)

    def head_object(self, object_key: str) -> dict:
        return self._client.head_object(Bucket=self.bucket, Key=object_key)

    def upload_file(self, source_path: str, object_key: str, content_type: str | None = None) -> str:
        extra_args = {}
        guessed_content_type = content_type or mimetypes.guess_type(source_path)[0] or "application/octet-stream"
        extra_args["ContentType"] = guessed_content_type
        self._client.upload_file(source_path, self.bucket, object_key, ExtraArgs=extra_args)
        return self.build_public_url(object_key)


def get_storage_service() -> S3StorageService:
    return S3StorageService()
