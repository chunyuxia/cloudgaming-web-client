// vite.config.js
import basicSsl from "@vitejs/plugin-basic-ssl";

export default {
  // Relative assets make the built app work both at / and on GitHub Pages
  // project URLs such as https://USER.github.io/REPO/.
  base: "./",
  server: {
    host: true,
  },
  plugins: [basicSsl()],
};
