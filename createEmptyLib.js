"use strict";

const chalk = require("chalk");
const commander = require("commander");
const fs = require("fs-extra");
const os = require("os");
const path = require("path");
const semver = require("semver");
const validateProjectName = require("validate-npm-package-name");

const packageJson = require("./package.json");

function isUsingYarn() {
  return (process.env.npm_config_user_agent || "").indexOf("yarn") === 0;
}

let projectName;

function init() {
  const program = new commander.Command(packageJson.name)
    .arguments("<project-directory>")
    .action((name) => {
      projectName = name;
    })
    .parse(process.argv);

  if (typeof projectName === "undefined") {
    console.error("Please specify the project directory:");
    console.log(
      `  ${chalk.cyan(program.name())} ${chalk.green("<project-directory>")}`
    );
    console.log();
    console.log("For example:");
    console.log(
      `  ${chalk.cyan(program.name())} ${chalk.green("my-empty-lib")}`
    );
    console.log();
    console.log(
      `Run ${chalk.cyan(`${program.name()} --help`)} to see all options.`
    );
    process.exit(1);
  }

  checkForLatestVersion()
    .catch(() => {
      try {
        return execSync("npm view create-empty-lib version").toString().trim();
      } catch (e) {
        return null;
      }
    })
    .then((latest) => {
      if (latest && semver.lt(packageJson.version, latest)) {
        console.log();
        console.error(
          chalk.yellow(
            `You are running \`create-empty-lib\` ${packageJson.version}, which is behind the latest release (${latest}).\n\n` +
              "We recommend always using the latest version of create-empty-lib if possible."
          )
        );
        console.log();
      } else {
        const useYarn = isUsingYarn();
        createApp(projectName, useYarn);
      }
    });
}

function createApp(name, useYarn) {
  const unsupportedNodeVersion = !semver.satisfies(
    // Coerce strings with metadata (i.e. `15.0.0-nightly`).
    semver.coerce(process.version),
    ">=14"
  );

  if (unsupportedNodeVersion) {
    console.log(
      chalk.red(
        `You are using Node ${process.version}.\n\n` +
          `Please update to Node 14 or higher.\n`
      )
    );

    process.exit(1);
  }

  const root = path.resolve(name);
  const appName = path.basename(root);

  checkAppName(appName);
  fs.ensureDirSync(name);
  if (!isSafeToCreateProjectIn(root, name)) {
    process.exit(1);
  }
  console.log();

  console.log(`Creating a new Empty lib in ${chalk.green(root)}.`);
  console.log();

  const packageJson = {
    name: appName,
    version: "1.0.0",
    description: "",
    author: "",
    license: "",
    private: false,
    exports: {
      "./package.json": "./package.json",
      ".": {
        // types: "./types/index.d.ts",
        import: "./esm/index.js",
        default: "./lib/index.js",
      },
      "./*": {
        // types: "./types/*.d.ts",
        import: "./esm/*.js",
        default: "./lib/*.js",
      },
    },
    files: [
      "esm/",
      "lib/",
      // , "types/"
    ],
    main: "lib/index.js",
    module: "esm/index.js",
    peerDependencies: {
      react: ">=17",
    },
    sideEffects: false,
    babel: {
      presets: ["@babel/preset-react"],
    },
    scripts: {
      build: "yarn build:lib && yarn build:esm",
      "build:esm":
        "babel src --out-dir esm --extensions '.js,.jsx,.ts,.tsx' --copy-files --delete-dir-on-start",
      "build:lib":
        "babel src --out-dir lib --extensions '.js,.jsx,.ts,.tsx' --copy-files --delete-dir-on-start",
    },
    devDependencies: {
      "@babel/cli": "^7.18.10",
      "@babel/core": "^7.18.13",
      "@babel/preset-react": "^7.18.6",
    },
  };

  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify(packageJson, null, 2) + os.EOL
  );

  process.chdir(root);
  if (!useYarn && !checkThatNpmCanReadCwd()) {
    process.exit(1);
  }

  if (!useYarn) {
    const npmInfo = checkNpmVersion();
    if (!npmInfo.hasMinNpm) {
      if (npmInfo.npmVersion) {
        console.log(
          chalk.yellow(
            `You are using npm ${npmInfo.npmVersion}.\n\n` +
              `Please update to npm 6 or higher.\n`
          )
        );

        process.exit(1);
      }
    }
  }
}

function checkNpmVersion() {
  let hasMinNpm = false;
  let npmVersion = null;
  try {
    npmVersion = execSync("npm --version").toString().trim();
    hasMinNpm = semver.gte(npmVersion, "6.0.0");
  } catch (err) {
    // ignore
  }
  return {
    hasMinNpm: hasMinNpm,
    npmVersion: npmVersion,
  };
}

function checkAppName(appName) {
  const validationResult = validateProjectName(appName);
  if (!validationResult.validForNewPackages) {
    console.error(
      chalk.red(
        `Cannot create a project named ${chalk.green(
          `"${appName}"`
        )} because of npm naming restrictions:\n`
      )
    );
    [
      ...(validationResult.errors || []),
      ...(validationResult.warnings || []),
    ].forEach((error) => {
      console.error(chalk.red(`  * ${error}`));
    });
    console.error(chalk.red("\nPlease choose a different project name."));
    process.exit(1);
  }
}

// If project only contains files generated by GH, it’s safe.
// Also, if project contains remnant error logs from a previous
// installation, lets remove them now.
// We also special case IJ-based products .idea because it integrates with CRA:
// https://github.com/facebook/create-react-app/pull/368#issuecomment-243446094
function isSafeToCreateProjectIn(root, name) {
  const validFiles = [
    ".DS_Store",
    ".git",
    ".gitattributes",
    ".gitignore",
    ".gitlab-ci.yml",
    ".hg",
    ".hgcheck",
    ".hgignore",
    ".idea",
    ".npmignore",
    ".travis.yml",
    "docs",
    "LICENSE",
    "README.md",
    "mkdocs.yml",
    "Thumbs.db",
  ];
  // These files should be allowed to remain on a failed install, but then
  // silently removed during the next create.
  const errorLogFilePatterns = [
    "npm-debug.log",
    "yarn-error.log",
    "yarn-debug.log",
  ];
  const isErrorLog = (file) => {
    return errorLogFilePatterns.some((pattern) => file.startsWith(pattern));
  };

  const conflicts = fs
    .readdirSync(root)
    .filter((file) => !validFiles.includes(file))
    // IntelliJ IDEA creates module files before CRA is launched
    .filter((file) => !/\.iml$/.test(file))
    // Don't treat log files from previous installation as conflicts
    .filter((file) => !isErrorLog(file));

  if (conflicts.length > 0) {
    console.log(
      `The directory ${chalk.green(name)} contains files that could conflict:`
    );
    console.log();
    for (const file of conflicts) {
      try {
        const stats = fs.lstatSync(path.join(root, file));
        if (stats.isDirectory()) {
          console.log(`  ${chalk.blue(`${file}/`)}`);
        } else {
          console.log(`  ${file}`);
        }
      } catch (e) {
        console.log(`  ${file}`);
      }
    }
    console.log();
    console.log(
      "Either try using a new directory name, or remove the files listed above."
    );

    return false;
  }

  // Remove any log files from a previous installation.
  fs.readdirSync(root).forEach((file) => {
    if (isErrorLog(file)) {
      fs.removeSync(path.join(root, file));
    }
  });
  return true;
}

// See https://github.com/facebook/create-react-app/pull/3355
function checkThatNpmCanReadCwd() {
  const cwd = process.cwd();
  let childOutput = null;
  try {
    // Note: intentionally using spawn over exec since
    // the problem doesn't reproduce otherwise.
    // `npm config list` is the only reliable way I could find
    // to reproduce the wrong path. Just printing process.cwd()
    // in a Node process was not enough.
    childOutput = spawn.sync("npm", ["config", "list"]).output.join("");
  } catch (err) {
    // Something went wrong spawning node.
    // Not great, but it means we can't do this check.
    // We might fail later on, but let's continue.
    return true;
  }
  if (typeof childOutput !== "string") {
    return true;
  }
  const lines = childOutput.split("\n");
  // `npm config list` output includes the following line:
  // "; cwd = C:\path\to\current\dir" (unquoted)
  // I couldn't find an easier way to get it.
  const prefix = "; cwd = ";
  const line = lines.find((line) => line.startsWith(prefix));
  if (typeof line !== "string") {
    // Fail gracefully. They could remove it.
    return true;
  }
  const npmCWD = line.substring(prefix.length);
  if (npmCWD === cwd) {
    return true;
  }
  console.error(
    chalk.red(
      `Could not start an npm process in the right directory.\n\n` +
        `The current directory is: ${chalk.bold(cwd)}\n` +
        `However, a newly started npm process runs in: ${chalk.bold(
          npmCWD
        )}\n\n` +
        `This is probably caused by a misconfigured system terminal shell.`
    )
  );
  if (process.platform === "win32") {
    console.error(
      chalk.red(`On Windows, this can usually be fixed by running:\n\n`) +
        `  ${chalk.cyan(
          "reg"
        )} delete "HKCU\\Software\\Microsoft\\Command Processor" /v AutoRun /f\n` +
        `  ${chalk.cyan(
          "reg"
        )} delete "HKLM\\Software\\Microsoft\\Command Processor" /v AutoRun /f\n\n` +
        chalk.red(`Try to run the above two lines in the terminal.\n`) +
        chalk.red(
          `To learn more about this problem, read: https://blogs.msdn.microsoft.com/oldnewthing/20071121-00/?p=24433/`
        )
    );
  }
  return false;
}

function checkForLatestVersion() {
  return new Promise((resolve, reject) => {
    https
      .get(
        "https://registry.npmjs.org/-/package/create-empty-lib/dist-tags",
        (res) => {
          if (res.statusCode === 200) {
            let body = "";
            res.on("data", (data) => (body += data));
            res.on("end", () => {
              resolve(JSON.parse(body).latest);
            });
          } else {
            reject();
          }
        }
      )
      .on("error", () => {
        reject();
      });
  });
}

module.exports = {
  init,
};
