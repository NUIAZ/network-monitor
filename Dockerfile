# ── Stage 1: build the React SPA ─────────────────────────────────────────────
FROM node:22 AS client
WORKDIR /src/networkmonitor.client
COPY networkmonitor.client/package*.json ./
RUN npm ci
COPY networkmonitor.client/ ./
RUN npm run build

# ── Stage 2: build and publish the .NET server ───────────────────────────────
# SkipSpaBuild=true: the SDK image has no Node; the SPA was built in stage 1.
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS server
WORKDIR /src
COPY NetworkMonitor.Server/NetworkMonitor.Server.csproj NetworkMonitor.Server/
RUN dotnet restore NetworkMonitor.Server/NetworkMonitor.Server.csproj -p:SkipSpaBuild=true
COPY NetworkMonitor.Server/ NetworkMonitor.Server/
RUN dotnet publish NetworkMonitor.Server/NetworkMonitor.Server.csproj \
    -c Release -o /app/publish -p:SkipSpaBuild=true

# ── Stage 3: runtime ─────────────────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime

# nmap so the container can actually scan; curl for the healthcheck.
# Note: the default scan profiles use TCP connect (-sT) on purpose — they work
# as a non-root user. Raw-socket scan types (-sS/-sU/-O) will not.
RUN apt-get update \
    && apt-get install -y --no-install-recommends nmap curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=server /app/publish .
COPY --from=client /src/networkmonitor.client/dist ./wwwroot

# Non-root user; /data holds the SQLite file (mount a volume there).
RUN useradd --create-home --uid 1001 netmon \
    && mkdir -p /data \
    && chown -R netmon:netmon /app /data
USER netmon

ENV ASPNETCORE_URLS=http://+:8080 \
    ConnectionStrings__Default="Data Source=/data/networkmonitor.db"

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:8080/api/settings/system || exit 1

ENTRYPOINT ["dotnet", "NetworkMonitor.Server.dll"]
