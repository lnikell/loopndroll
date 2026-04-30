import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const wrapperBundlePath = process.env["ELECTROBUN_WRAPPER_BUNDLE_PATH"];
const buildDir = process.env["ELECTROBUN_BUILD_DIR"];
const appName = process.env["ELECTROBUN_APP_NAME"];
const appBundleName = appName?.endsWith(".app") ? appName : `${appName}.app`;
const bundlePath =
  wrapperBundlePath ?? (buildDir && appName ? join(buildDir, appBundleName) : undefined);

if (!bundlePath) {
  throw new Error(
    "ELECTROBUN_WRAPPER_BUNDLE_PATH or ELECTROBUN_BUILD_DIR/ELECTROBUN_APP_NAME is required",
  );
}

const sourcePath = join(process.cwd(), "src/assets/AppIcon.icns");
const destinationPath = join(bundlePath, "Contents/Resources/AppIcon.icns");

if (!existsSync(sourcePath)) {
  throw new Error(`Missing app icon asset: ${sourcePath}`);
}

mkdirSync(dirname(destinationPath), { recursive: true });
copyFileSync(sourcePath, destinationPath);
console.log(`Copied macOS app icon to ${destinationPath}`);
