FROM node:22-bookworm-slim

ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN mkdir -p /app/media

EXPOSE 3000
CMD ["sh", "-c", "npm run build && npm run start -- --hostname 0.0.0.0 --port 3000"]
