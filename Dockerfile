FROM python:3.11-slim

WORKDIR /app

# Install netcat and dos2unix to fix Windows line endings
RUN apt-get update && apt-get install -y netcat-openbsd dos2unix && rm -rf /var/lib/apt/lists/*

# Copy requirements and install them
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the code
COPY . .

# Convert entrypoint.sh to Unix line endings and make it executable
RUN dos2unix entrypoint.sh && chmod +x entrypoint.sh

# Use entrypoint script
ENTRYPOINT ["./entrypoint.sh"]
