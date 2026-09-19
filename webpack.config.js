import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import CopyWebpackPlugin from 'copy-webpack-plugin';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Load environment variables from .env file.
 * This allows users to customize build behavior without modifying
 * the webpack config directly.
 */
dotenv.config();

const outputFileName = process.env.OUTPUT_FILE_NAME || 'main.min.js';
const separateCss = process.env.SEPARATE_CSS === 'true';
const port = process.env.PORT || 3000;

/**
 * Check if assets directory exists and has files.
 * We only add CopyWebpackPlugin if there are actual assets to copy,
 * avoiding unnecessary build overhead for projects without static files.
 */
const assetsPath = path.join(__dirname, 'assets');
const hasAssets = (() => {
  try {
    return fs.existsSync(assetsPath) && fs.readdirSync(assetsPath).length > 0;
  } catch {
    return false;
  }
})();

const isDev = process.env.NODE_ENV !== 'production';

/**
 * A note on the database.
 *
 * The SQLite database (node:sqlite) runs in the Electron main process
 * (electron/database.js) and needs no special web platform features.
 * The WebAssembly support configured below serves the C++/Rust demo
 * components (Emscripten / wasm-pack), which DO need .wasm handling.
 *
 * Webpack Configuration
 *
 * This configuration is designed for vanilla JavaScript projects with:
 * - Modern CSS processing (PostCSS + cssnano)
 * - Fast JavaScript transpilation (SWC)
 * - Web Worker inlining for single-file deployment (classic workers)
 * - WebAssembly support for C++ (Emscripten) and Rust (wasm-pack)
 * - Static asset copying
 * - Environment-based customization
 */
export default {
  entry: './index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: isDev ? '[name].js' : outputFileName,
    /**
     * Additional chunks (dynamic import() of the Emscripten/wasm-pack
     * glue code) need their own filename pattern so they do not
     * collide with the fixed entry filename above.
     */
    chunkFilename: isDev ? '[name].js' : 'chunks/[name].min.js',
    clean: true,
    /**
     * WebAssembly files need a predictable public path so that the
     * Emscripten and wasm-pack generated modules can load their
     * companion .wasm binaries at runtime.
     */
    publicPath: '/',
  },
  mode: isDev ? 'development' : 'production',
  /**
   * Enable WebAssembly support.
   * asyncWebAssembly allows wasm modules to be loaded asynchronously,
   * which is required for both Emscripten MODULARIZE output and
   * wasm-pack generated ES modules.
   */
  experiments: {
    asyncWebAssembly: true,
  },
  devServer: {
    static: {
      directory: path.join(__dirname, 'assets'),
      publicPath: '/',
    },
    /**
     * Show the full-screen error overlay for compilation ERRORS only.
     * If the overlay reacted to warnings it would cover the page and
     * intercept all clicks — which also breaks e2e test automation.
     */
    client: {
      overlay: {
        errors: true,
        warnings: false,
      },
    },
    /**
     * Emit a custom header so Electron can verify that this is the
     * project's own dev server and not an unrelated service that happens
     * to be listening on the same port.
     */
    headers: {
      'X-Pochade-Dev-Server': 'pochade',
    },
    port: port,
    hot: true,
    open: false,
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        use: [
          separateCss ? MiniCssExtractPlugin.loader : 'style-loader',
          {
            loader: 'css-loader',
            options: isDev ? {} : {
              importLoaders: 1,
              modules: false,
            }
          },
          {
            loader: 'postcss-loader',
            options: isDev ? {} : {
              postcssOptions: {
                plugins: [
                  ['cssnano', {
                    preset: ['default', {
                      discardComments: {
                        removeAll: true,
                      },
                    }],
                  }],
                ],
              },
            }
          }
        ],
      },
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: [
          {
            loader: path.resolve(__dirname, 'scripts/transform-workers.js'),
          },
          {
            loader: 'swc-loader',
            options: {
              jsc: {
                parser: {
                  syntax: 'ecmascript',
                },
                target: 'es2015',
              },
            },
          },
        ],
      },
      /**
       * WebAssembly file handling.
       * Webpack 5's asset/resource type emits .wasm files to the output
       * directory and returns the public URL. The Emscripten and
       * wasm-pack runtime loaders fetch the .wasm binary at runtime via
       *   import('./module.wasm')
       */
      {
        test: /\.wasm$/,
        type: 'asset/resource',
        generator: {
          filename: 'wasm/[name][ext]',
        },
      },
    ],
  },
  optimization: {
    splitChunks: false,
    runtimeChunk: isDev ? 'single' : false,
  },
  resolve: {
    /**
     * Include .wasm in resolve.extensions so that imports like:
     *   import('./module.wasm')
     * are resolved without requiring the full extension.
     */
    extensions: ['.js', '.json', '.wasm'],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './index.html',
    }),
    ...(separateCss ? [new MiniCssExtractPlugin()] : []),
    ...(hasAssets
      ? [
          new CopyWebpackPlugin({
            patterns: [
              {
                from: 'assets',
                to: '.',
              },
            ],
          }),
        ]
      : []),
  ],
};
