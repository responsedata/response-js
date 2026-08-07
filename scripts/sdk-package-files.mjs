export const sdkPackageFiles = [
  "packages/browser/package.json",
  "packages/server/package.json",
  "packages/next/package.json",
];

// npm trusted publishing can only be configured after a package exists. Keep
// this allowlist deliberately narrow so the release flow can never claim a
// misspelled or otherwise unexpected package name during local bootstrap.
export const locallyBootstrapableSdkPackageNames = ["@responsedata/server"];
