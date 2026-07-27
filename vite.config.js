// vite.config.js
import basicSsl from "@vitejs/plugin-basic-ssl";

function unityBrotliHeaders() {
  return {
    name: "unity-brotli-headers",
    configureServer(server) {
      server.middlewares.use(addUnityBrotliHeaders);
    },
    configurePreviewServer(server) {
      server.middlewares.use(addUnityBrotliHeaders);
    },
  };
}

function addUnityBrotliHeaders(req, res, next) {
  const url = req.url || "";
  if (url.endsWith(".br")) {
    res.setHeader("Content-Encoding", "br");
    if (url.endsWith(".wasm.br")) {
      res.setHeader("Content-Type", "application/wasm");
    } else if (url.endsWith(".js.br")) {
      res.setHeader("Content-Type", "application/javascript");
    } else if (url.endsWith(".data.br")) {
      res.setHeader("Content-Type", "application/octet-stream");
    }
  }
  next();
}

export default {
  // Relative assets make the built app work both at / and on GitHub Pages
  // project URLs such as https://USER.github.io/REPO/.
  base: "./",
  server: {
    host: true,
  },
  plugins: [basicSsl(), unityBrotliHeaders()],
};
