// NativeWind v4: `className` support via the JSX import source + preset.
// babel-preset-expo already adds the Reanimated 4 / worklets plugin.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
  };
};
