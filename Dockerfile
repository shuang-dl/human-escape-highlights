# Weekly Support AI Insights — generator app + hub.
# A small Node/Express server serves the hub and the weekly reports, and exposes
# one action (POST /api/generate) that pulls last week's escalations from the
# Intercom API and builds the report. Any platform that builds this Dockerfile from
# the GitHub repo (e.g. DeployBay) will get a running app.

FROM node:20-alpine

# tzdata so the "previous work week" dates are computed in the right timezone.
RUN apk add --no-cache tzdata
ENV TZ=America/New_York

# The server listens on $PORT (defaults to 80). Hosts that inject their own $PORT
# are respected automatically.
ENV PORT=80

WORKDIR /app

# Install dependencies first (better build caching).
COPY package*.json ./
RUN npm install --omit=dev

# App code + the static site (hub + committed reports).
COPY server/ ./server/
COPY index.html ./index.html
COPY reports/ ./reports/

# IMPORTANT: the Intercom API token is provided at runtime as a secret, NOT baked in.
# Set INTERCOM_TOKEN in your deploy platform's environment/secrets.

EXPOSE 80
CMD ["node", "server/server.js"]
