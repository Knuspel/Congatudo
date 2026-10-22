/* eslint-disable */
const fs = require("fs");
const path = require("path");
const UPX = require("upx");

// Cache file suffixes of the base runtimes pkg worked from, per flavor.
// pkg no longer keeps "built-" copies around in newer versions, so both
// naming schemes are accepted.
const flavorCacheSuffixes = {
    armv7: "linuxstatic-armv7",
    armv7_lowmem: "linuxstatic-armv7",
    aarch64: "linuxstatic-arm64",
    amd64: "linuxstatic-x64"
};

/**
 * Finds the base runtime pkg fetched for a flavor inside PKG_CACHE_PATH.
 * The relevant part of that file is its file size: pkg appends its payload
 * right after the (in-place patched) runtime, so slicing at that size
 * separates the two.
 */
function findBaseForFlavor(flavor) {
    const pkgRoot = "./build_dependencies/pkg";
    const suffix = flavorCacheSuffixes[flavor];

    if (!fs.existsSync(pkgRoot)) {
        throw new Error("PKG_CACHE_PATH does not exist. Did the pkg builds run first?");
    }

    const candidates = [];
    for (const versionDir of fs.readdirSync(pkgRoot).sort().reverse()) {
        const versionDirPath = path.join(pkgRoot, versionDir);
        if (!fs.statSync(versionDirPath).isDirectory()) {
            continue;
        }

        const files = fs.readdirSync(versionDirPath).filter((file) => {
            return file.endsWith(suffix) && (file.startsWith("built-") || file.startsWith("fetched-"));
        });

        if (files.length === 0) {
            continue;
        }

        // Prefer built- runtimes (needed by pkg 5 / already cut out by 6) over fetched-, exactly
        // as pkg itself used them during the build in this very cache version directory only
        const builtFile = files.find((file) => file.startsWith("built-"));

        candidates.push(path.join(versionDirPath, builtFile ?? files[0]));
    }

    if (candidates.length === 0) {
        throw new Error("Could not find a pkg base runtime for flavor " + suffix + ". Did the pkg build for it run first?");
    }

    // The newest cache version directory wins
    return candidates[0];
}

async function run() {
    console.log("Starting UPX compression");

    for (const [name, built, out] of [
        ["armv7", "./build/armv7/valetudo", "./build/armv7/valetudo.upx"],
        ["armv7_lowmem", "./build/armv7/valetudo-lowmem", "./build/armv7/valetudo-lowmem.upx"],
        ["aarch64", "./build/aarch64/valetudo", "./build/aarch64/valetudo.upx"],
        ["amd64", "./build/amd64/valetudo", "./build/amd64/valetudo.upx"]
    ]) {
        console.log("Compressing " + built);

        const base = findBaseForFlavor(name);

        console.time(name);

        const baseSize = fs.readFileSync(base).length;
        const builtFile = fs.readFileSync(built);

        if (builtFile.length <= baseSize) {
            throw new Error("Built binary " + built + " is not larger than its base runtime - cannot be split");
        }

        const runtime = builtFile.subarray(0, baseSize);
        const payload = builtFile.subarray(baseSize);

        // UPX will reject files without the executable bit on linux. Also, default mode is 666
        fs.writeFileSync(out + "_runtime", runtime, {mode: 0o777});

        const upxResult = await UPX({lzma: true, best: true})(out + "_runtime").start();

        console.log("Compressed " + built + " from " + upxResult.fileSize.before + " to " + upxResult.fileSize.after + ". Ratio: " + upxResult.ratio);

        const compressedRuntime = fs.readFileSync(out + "_runtime");
        fs.unlinkSync(out + "_runtime");

        fs.writeFileSync(out, Buffer.concat([compressedRuntime, payload]), {mode: 0o777});

        console.log("Successfully wrote " + out);
        console.timeEnd(name);
    }
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
