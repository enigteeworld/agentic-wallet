import fs from "fs";
import path from "path";
import http from "http";

function contentTypeFor(filepath: string): string {
  if (filepath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filepath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filepath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filepath.endsWith(".js")) return "application/javascript; charset=utf-8";
  return "text/plain; charset=utf-8";
}

function publicDir(): string {
  return path.resolve(process.cwd(), "public");
}

export async function serveTelemetry(params: {
  port: number;
}): Promise<void> {
  const root = publicDir();

  const server = http.createServer((req, res) => {
    const requestPath = req.url === "/" ? "/telemetry" : String(req.url || "/");
    const sanitized = requestPath.split("?")[0];
    let filepath = path.join(root, sanitized);

    if (fs.existsSync(filepath) && fs.statSync(filepath).isDirectory()) {
      filepath = path.join(filepath, "index.html");
    }

    if (!filepath.startsWith(root)) {
      res.statusCode = 403;
      res.end("Forbidden");
      return;
    }

    if (!fs.existsSync(filepath)) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }

    res.setHeader("Content-Type", contentTypeFor(filepath));
    fs.createReadStream(filepath).pipe(res);
  });

  await new Promise<void>((resolve) => {
    server.listen(params.port, () => resolve());
  });

  console.log(`Telemetry server listening on http://localhost:${params.port}`);
  console.log(`Open http://localhost:${params.port}/telemetry`);
}