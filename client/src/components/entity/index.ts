/**
 * @file index.ts
 * @description Barrel for the entity molecules: the `EntityRef` chip and the
 * `entityMenu` builder with its href/value/project helpers. Types are
 * re-exported with `export type` because the client compiles with
 * `isolatedModules`.
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

export { EntityRef } from "./EntityRef";
export type { EntityRefProps } from "./EntityRef";
export { entityMenu, entityHref, entityValue } from "./entityMenu";
export type { EntityTarget, EntityMenuCtx } from "./entityMenu";
export { projectParts } from "../../lib/project";
