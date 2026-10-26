FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY shared ./shared
COPY publishing-api ./publishing-api
COPY source-stub ./source-stub
COPY vendor-stub ./vendor-stub
RUN npm run build:backend && npm prune --omit=dev

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN mkdir /archive && chown node:node /archive
USER node

FROM runtime AS publishing-api
ENV ARCHIVE_DIR=/archive API_PORT=3001
EXPOSE 3001
CMD ["node", "dist/publishing-api/src/server.js"]

FROM runtime AS source-stub
ENV SOURCE_PORT=3002
EXPOSE 3002
CMD ["node", "dist/source-stub/src/server.js"]

FROM runtime AS vendor-stub
ENV VENDOR_PORT=3003
EXPOSE 3003
CMD ["node", "dist/vendor-stub/src/server.js"]

FROM node:24-alpine AS frontend-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY frontend ./frontend
COPY shared ./shared
RUN npm run build:frontend

FROM nginxinc/nginx-unprivileged:stable-alpine AS frontend
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend-build /app/dist/frontend /usr/share/nginx/html
EXPOSE 8080
