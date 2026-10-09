const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// inlineRem 16 matches React Native Reusables' sizing assumptions.
module.exports = withNativeWind(config, { input: './global.css', inlineRem: 16 });
