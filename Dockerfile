# The quick start: the emulator's page, the bridge in emulator mode and Sage's mind, with nothing to install but Docker
# (compose.yaml runs it). The bridge that drives a real board stays native: a container cannot feel the Mac (the
# Claude app, idle, sounds) and Docker on a Mac cannot reach the board's USB serial port (docs/ROADMAP.md, Phase 7).
FROM node:22.14.0-bookworm-slim

# emulator mode needs only Python's standard library; the mind needs only Node
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /desk-sage
COPY --chown=node:node . .
USER node

EXPOSE 47823
CMD ["python3", "tools/buddy_bridge.py", "--emulator", "--listen", "0.0.0.0"]
