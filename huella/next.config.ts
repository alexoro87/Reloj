import type { NextConfig } from "next";

// La agenda es dinámica por naturaleza (huecos libres en tiempo real), así que
// no usamos Cache Components: cada página consulta la base de datos por petición.
const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
