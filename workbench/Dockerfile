# Wisner Workbench — production image (works on Railway, Fly.io, Render, or any Docker host)
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build does not need real secrets; the app reads them at runtime.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# Runtime needs: standalone server, static assets, public files, migrations + migrate script.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=build /app/node_modules/postgres ./node_modules/postgres
COPY --from=build /app/node_modules/dotenv ./node_modules/dotenv
COPY --from=build /app/node_modules/tsx ./node_modules/tsx
COPY --from=build /app/node_modules/.bin/tsx ./node_modules/.bin/tsx
COPY --from=build /app/node_modules/esbuild ./node_modules/esbuild
COPY --from=build /app/node_modules/@esbuild ./node_modules/@esbuild
COPY --from=build /app/node_modules/get-tsconfig ./node_modules/get-tsconfig
COPY --from=build /app/node_modules/resolve-pkg-maps ./node_modules/resolve-pkg-maps
EXPOSE 3000
# Apply pending migrations, then start.
CMD ["sh", "-c", "node_modules/.bin/tsx scripts/migrate.ts && node server.js"]
