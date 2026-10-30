import logging
import smtplib
from email.message import EmailMessage

from app.core.config import settings

logger = logging.getLogger(__name__)


def mask_auth_email(email: str) -> str:
    local_part, _, domain = email.partition("@")
    if len(local_part) <= 2:
        masked_local = local_part[:1] + "*"
    else:
        masked_local = f"{local_part[:2]}***{local_part[-1:]}"
    return f"{masked_local}@{domain}"


def send_auth_email_code(*, to_email: str, code: str) -> None:
    message_body = f"Ваш код авторизации Дармавоз: {code}. Никому не сообщайте его."
    masked_email = mask_auth_email(to_email)
    if not settings.SMTP_HOST:
        logger.warning("auth_email_code_not_sent email=%s smtp_configured=false", masked_email)
        from app.services.journey import observe_auth_delivery_failure
        observe_auth_delivery_failure("EMAIL_NOT_CONFIGURED")
        return

    message = EmailMessage()
    message["Subject"] = "Код авторизации Дармавоз"
    message["From"] = settings.SMTP_FROM_EMAIL or settings.SMTP_USER or "no-reply@darmavoz.local"
    message["To"] = to_email
    message.set_content(message_body)

    smtp_port = settings.SMTP_PORT or 465
    smtp_user = settings.SMTP_USER or ""
    smtp_password = settings.SMTP_PASSWORD or ""

    try:
        if smtp_port == 465:
            with smtplib.SMTP_SSL(settings.SMTP_HOST, smtp_port, timeout=15) as smtp:
                if smtp_user:
                    smtp.login(smtp_user, smtp_password)
                smtp.send_message(message)
        else:
            with smtplib.SMTP(settings.SMTP_HOST, smtp_port, timeout=15) as smtp:
                smtp.ehlo()
                try:
                    smtp.starttls()
                    smtp.ehlo()
                except smtplib.SMTPNotSupportedError:
                    logger.warning("smtp_starttls_not_supported host=%s", settings.SMTP_HOST)
                if smtp_user:
                    smtp.login(smtp_user, smtp_password)
                smtp.send_message(message)
    except (OSError, smtplib.SMTPException) as exc:
        logger.error("auth_email_code_send_failed email=%s type=%s", masked_email,type(exc).__name__)
        from app.services.journey import observe_auth_delivery_failure
        observe_auth_delivery_failure("EMAIL_DELIVERY_FAILED")
        # The HTTP response has already been sent by BackgroundTasks. Keep the
        # failure in the bounded journey journal rather than exposing SMTP data.
        return

    logger.warning("auth_email_code_sent email=%s", masked_email)
