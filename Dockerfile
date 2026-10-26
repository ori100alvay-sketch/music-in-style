# Lightweight production web app. Keep Demucs/PyTorch out of the free web container:
# the free Render instance cannot reliably run CPU inference. The optional worker
# lives in demucs-worker/ and must be deployed separately on suitable resources.
FROM node:20-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 10000
CMD ["npm", "start"]
