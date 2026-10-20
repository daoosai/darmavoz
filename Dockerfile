FROM python:3.11-slim

WORKDIR /app

# Install netcat and dos2unix to fix Windows line endings
RUN apt-get update && apt-get install -y netcat-openbsd dos2unix && rm -rf /var/lib/apt/lists/*

# Copy requirements and install them
COPY requirements.txt requirements.lock ./
RUN pip install --no-cache-dir --upgrade pip==26.2.1 setuptools==84.0.0 \
    && pip install --no-cache-dir -r requirements.txt -c requirements.lock

# Copy the rest of the code
ARG APP_BUILD_COMMIT=unknown
LABEL org.opencontainers.image.revision=$APP_BUILD_COMMIT
COPY . .

# Convert entrypoint.sh to Unix line endings and make it executable
RUN dos2unix entrypoint.sh && chmod +x entrypoint.sh

# Use entrypoint script
ENTRYPOINT ["./entrypoint.sh"]
