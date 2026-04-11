const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

function parseProfileName(argv) {
  const profileArg = argv.find((value) => value.startsWith("--profile="));
  if (!profileArg) {
    return "default";
  }

  const value = profileArg.slice("--profile=".length).trim();
  return value || "default";
}

async function main() {
  const profileName = parseProfileName(process.argv.slice(2));
  const profileDir = path.join(os.homedir(), "AppData", "Roaming", "Syncall Desktop", "profiles", profileName);

  await fs.rm(profileDir, { recursive: true, force: true });

  console.log(`Removed local desktop profile state for "${profileName}".`);
  console.log(profileDir);
}

main().catch((error) => {
  console.error("Failed to reset local desktop profile state.");
  console.error(error);
  process.exit(1);
});
