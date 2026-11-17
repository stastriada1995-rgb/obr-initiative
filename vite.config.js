import { readFileSync } from "fs";
import { resolve } from "path";
import { defineConfig } from "vite";

// Адрес сайта на GitHub Pages: https://<логин>.github.io/<репозиторий>/
// Базовый путь = "/<репозиторий>/". При сборке через GitHub Actions он
// подставляется автоматически из имени репозитория (переменная BASE).
const BASE = process.env.BASE || "/obr-initiative/";

// manifest.json собирается из шаблона: все пути получают префикс репозитория
function manifestPlugin(base) {
  const render = () =>
    readFileSync(resolve(__dirname, "manifest.template.json"), "utf8").replaceAll("%BASE%", base);
  return {
    name: "obr-manifest",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "manifest.json", source: render() });
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === `${base}manifest.json`) {
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Access-Control-Allow-Origin", "*");
          return res.end(render());
        }
        next();
      });
    },
  };
}

export default defineConfig({
  base: BASE,
  plugins: [manifestPlugin(BASE)],
  server: {
    cors: true, // Owlbear загружает расширение с другого домена
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        background: resolve(__dirname, "background.html"),
        skills: resolve(__dirname, "skills.html"),
      },
    },
  },
});
