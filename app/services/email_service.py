import logging
import smtplib
from email.message import EmailMessage

from app.core.config import settings

logger = logging.getLogger(__name__)


def send_email(*, to_email: str, subject: str, body: str) -> None:
    smtp_host = settings.SMTP_HOST
    smtp_user = settings.SMTP_USER or ""
    if not smtp_host:
        logger.info("Mock Email: уведомление сгенерировано (SMTP не настроен)")
        return

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = settings.SMTP_FROM_EMAIL or smtp_user or "no-reply@darmavoz.local"
    message["To"] = to_email
    message.set_content(body)

    smtp_port = settings.SMTP_PORT or 465
    smtp_password = settings.SMTP_PASSWORD or ""

    if smtp_port == 465:
        with smtplib.SMTP_SSL(smtp_host, smtp_port) as smtp:
            if smtp_user:
                smtp.login(smtp_user, smtp_password)
            smtp.send_message(message)
        return

    with smtplib.SMTP(smtp_host, smtp_port) as smtp:
        smtp.ehlo()
        try:
            smtp.starttls()
            smtp.ehlo()
        except smtplib.SMTPNotSupportedError:
            logger.info("SMTP server does not support STARTTLS, continuing without it")
        if smtp_user:
            smtp.login(smtp_user, smtp_password)
        smtp.send_message(message)


def send_admin_moderation_email(*, to_email: str, driver_label: str) -> None:
    send_email(
        to_email=to_email,
        subject="ДАРМАВОЗ: Новая заявка на модерацию!",
        body=(
            "Здравствуйте!\n\n"
            f"Водитель {driver_label} отправил данные автомобиля на проверку.\n\n"
            "Пожалуйста, зайдите в панель администратора для проверки."
        ),
    )
