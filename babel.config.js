module.exports = {
  presets: [
    ['@babel/preset-env', {
      targets: { node: '18' },
      corejs: { version: '3.32', proposals: true },
      useBuiltIns: 'usage'
    }],
    '@babel/preset-typescript'
  ],
  plugins: [
    ['@babel/plugin-transform-runtime', {
      corejs: { version: 3, proposals: true }
    }]
  ]
};
