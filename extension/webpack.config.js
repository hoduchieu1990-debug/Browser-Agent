const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
  mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  devtool: 'source-map',
  entry: {
    background: './src/background.ts',
    'content-script': './src/content-script.ts',
    popup: './src/popup/index.tsx',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js'],
    alias: {
      // Compile the shared table reader from source. Pulling in its CommonJS
      // build instead makes webpack emit a CJS interop helper without the
      // runtime that backs it, and the content script dies on
      // "__webpack_require__ is not defined".
      '@browser-agent/shared/dist/table-reader': path.resolve(__dirname, '..', 'shared', 'table-reader.ts'),
    },
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: { loader: 'ts-loader', options: { transpileOnly: true } },
        exclude: /node_modules/,
      },
    ],
  },
  plugins: [
    new CopyPlugin({
      patterns: [{ from: 'public', to: '.' }],
    }),
  ],
};
