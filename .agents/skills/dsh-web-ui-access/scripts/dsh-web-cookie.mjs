#!/usr/bin/env node
/**
 * Mint the browser-session cookie a running dsh web listener accepts.
 *
 * The listener authenticates `GET /` and its `/api` channels with a signed
 * cookie whose key is the persistent `client-connection/browser-session`
 * secret in `$DSH_HOME/.credentials.yaml`. This script reads that secret and
 * prints the cookie for one authority; it never prints the secret itself.
 *
 * Usage:
 *   node dsh-web-cookie.mjs [--url <webUrl>] [--home <dshHome>] [--hours <n>]
 *                           [--header | --json | --name]
 *
 * Defaults: url = $DSH_WEB_URL, home = $DSH_HOME, hours = 1.
 * Output: `name=value` (default), `Cookie: name=value` (--header),
 *         JSON (--json), or the bare name (--name).
 */
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const RECORD_KEY = "client-connection/browser-session";
const SECRET_BYTES = 32;
const COOKIE_PREFIX = "dsh-auth-";
const COOKIE_PAYLOAD_VERSION = 1;
const DEFAULT_HOURS = 1;

function fail(message) {
	process.stderr.write(`dsh-web-cookie: ${message}\n`);
	process.exit(1);
}

function parseArgs(argv) {
	const options = { url: process.env.DSH_WEB_URL, home: process.env.DSH_HOME, hours: DEFAULT_HOURS, output: "pair" };
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		const next = () => {
			const value = argv[index + 1];
			if (value === undefined) fail(`${arg} needs a value`);
			index += 1;
			return value;
		};
		if (arg === "--url") options.url = next();
		else if (arg === "--home") options.home = next();
		else if (arg === "--hours") options.hours = Number(next());
		else if (arg === "--header") options.output = "header";
		else if (arg === "--json") options.output = "json";
		else if (arg === "--name") options.output = "name";
		else fail(`unknown argument ${arg}`);
	}
	if (options.url === undefined || options.url === "") fail("no web URL: set DSH_WEB_URL or pass --url");
	if (options.home === undefined || options.home === "") options.home = join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".dsh");
	if (!Number.isFinite(options.hours) || options.hours <= 0) fail("--hours must be a positive number");
	return options;
}

/** Read `records -> <RECORD_KEY> -> payload -> secret` from the credentials YAML. */
function readSecret(text) {
	const lines = text.split(/\r?\n/);
	const header = /^(\s*)["']?client-connection\/browser-session["']?:\s*$/;
	for (let index = 0; index < lines.length; index += 1) {
		const match = header.exec(lines[index]);
		if (match === null) continue;
		const recordIndent = match[1].length;
		for (let inner = index + 1; inner < lines.length; inner += 1) {
			const line = lines[inner];
			const trimmed = line.trim();
			if (trimmed === "" || trimmed.startsWith("#")) continue;
			if (line.length - line.trimStart().length <= recordIndent) break;
			const secret = /^secret:\s*(\S+)\s*$/.exec(trimmed);
			if (secret !== null) return secret[1].replace(/^["']|["']$/gu, "");
		}
	}
	return undefined;
}

function decodeBase64Url(value) {
	if (!/^[A-Za-z0-9_-]*$/u.test(value) || value.length % 4 === 1) return undefined;
	const padding = "=".repeat((4 - (value.length % 4)) % 4);
	return Buffer.from(value.replaceAll("-", "+").replaceAll("_", "/") + padding, "base64");
}

function encodeBase64Url(value) {
	return Buffer.from(value).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

const options = parseArgs(process.argv.slice(2));

let authority;
try {
	authority = new URL(options.url).host;
} catch {
	fail(`--url is not a valid URL: ${options.url}`);
}
if (authority === "") fail(`no host in ${options.url}`);

const credentialsPath = resolve(join(options.home, ".credentials.yaml"));
let credentials;
try {
	credentials = readFileSync(credentialsPath, "utf8");
} catch (error) {
	fail(`cannot read ${credentialsPath}: ${error.code ?? error.message}`);
}
const encodedSecret = readSecret(credentials);
if (encodedSecret === undefined) {
	fail(`${credentialsPath} has no ${RECORD_KEY} record; start dsh web once so it creates one`);
}
const secret = decodeBase64Url(encodedSecret);
if (secret === undefined || secret.byteLength !== SECRET_BYTES) {
	fail(`${RECORD_KEY} secret is not ${SECRET_BYTES} base64url bytes; delete that record and start dsh web to regenerate it`);
}

const name = COOKIE_PREFIX + encodeBase64Url(createHash("sha256").update(authority).digest());
const issuedAt = Date.now();
const expiresAt = issuedAt + Math.floor(options.hours * 3600_000);
const body = encodeBase64Url(Buffer.from(JSON.stringify({ version: COOKIE_PAYLOAD_VERSION, authority, issuedAt, expiresAt }), "utf8"));
const value = `v1.${body}.${encodeBase64Url(createHmac("sha256", secret).update(body).digest())}`;

if (options.output === "header") process.stdout.write(`Cookie: ${name}=${value}\n`);
else if (options.output === "json") process.stdout.write(`${JSON.stringify({ name, value, authority, issuedAt, expiresAt })}\n`);
else if (options.output === "name") process.stdout.write(`${name}\n`);
else process.stdout.write(`${name}=${value}\n`);
