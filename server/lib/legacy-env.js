/**
 * @file Mirrors legacy `CCAM_*` environment variables onto their `AM_*`
 * successors so hook installs and deployments written before the Agent Monitor
 * rebrand keep working. A value already set under the new name always wins.
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

for (const [key, value] of Object.entries(process.env)) {
  if (!key.startsWith("CCAM_")) continue;
  const next = "AM_" + key.slice("CCAM_".length);
  if (process.env[next] === undefined) process.env[next] = value;
}
