import json

import boto3
from botocore.client import Config as BotoConfig
from botocore.exceptions import ClientError

from app.core.config import settings


cors_configuration = {
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


def main() -> None:
    client = boto3.client(
        "s3",
        endpoint_url=settings.S3_ENDPOINT,
        region_name=settings.S3_REGION,
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
        use_ssl=settings.S3_USE_SSL,
        config=BotoConfig(signature_version="s3v4", s3={"addressing_style": "path"}),
    )

    print({"bucket": settings.S3_BUCKET, "endpoint": settings.S3_ENDPOINT})
    try:
        client.put_bucket_cors(
            Bucket=settings.S3_BUCKET,
            CORSConfiguration=cors_configuration,
        )
        applied = client.get_bucket_cors(Bucket=settings.S3_BUCKET)
        print(json.dumps(applied, ensure_ascii=False))
    except ClientError as exc:
        error_code = exc.response.get("Error", {}).get("Code", "")
        print(
            json.dumps(
                {
                    "status": "error",
                    "error_code": error_code,
                    "message": str(exc),
                },
                ensure_ascii=False,
            )
        )
        raise


if __name__ == "__main__":
    main()
