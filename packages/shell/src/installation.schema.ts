import * as z from 'zod/mini';

// 32, 253 and 270 mirror the kit's id, host-name and origin limits.
export const KEBAB = /^[a-z][a-z0-9-]*$/;
const Kebab = z.string().check(z.maxLength(32), z.regex(KEBAB));

export interface WidgetNode {
  kind: 'widget';
  extension: string;
  name: string;
}

export interface LayoutBox {
  kind: 'row' | 'column';
  children: Layout[];
}

export type Layout = WidgetNode | LayoutBox;

const WidgetNodeSchema = z.object({ kind: z.literal('widget'), extension: Kebab, name: Kebab });

export const LayoutSchema: z.ZodMiniType<Layout> = z.union([
  WidgetNodeSchema,
  z.object({
    kind: z.enum(['row', 'column']),
    get children() {
      return z.array(LayoutSchema);
    },
  }),
]);

// The kit's OriginSchema: https or loopback http, no path, so discovery and modules share it.
export const ORIGIN =
  /^(https:\/\/[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+|http:\/\/(127\.0\.0\.1|localhost))(:[0-9]{1,5})?$/;
const Origin = z.string().check(z.maxLength(270), z.regex(ORIGIN));

const DeploymentSchema = z.object({ id: Kebab, url: Origin });

const RouteKey = z.string().check(z.maxLength(64), z.regex(/^\//));
const RoutesSchema = z.record(RouteKey, LayoutSchema);

export const InstallationSchema = z.object({
  target: z.string().check(z.minLength(1), z.maxLength(253)),
  deployments: z.array(DeploymentSchema),
  routes: RoutesSchema,
});

// A route present here replaces that route's layout in the installation.
export const OverlaySchema = z.object({ routes: RoutesSchema });

const ok = <T extends z.ZodMiniType>(data: T) => z.object({ success: z.literal(true), data });
export const InstallationEnvelope = ok(InstallationSchema);
export const OverlayEnvelope = ok(OverlaySchema);

export type Installation = z.infer<typeof InstallationSchema>;
export type Overlay = z.infer<typeof OverlaySchema>;
export type Deployment = z.infer<typeof DeploymentSchema>;

export const ELEMENT = /^[a-z][a-z0-9]*-[a-z0-9-]+$/;
export const MODULE = /^\/ui\/[^/]+\/[^/]+\.m?js$/;

// The slice of /.well-known/agentage-extension.json a shell reads.
export const DiscoverySchema = z.object({
  widgets: z.optional(
    z.array(
      z.object({
        name: z.string().check(z.regex(KEBAB)),
        element: z.string().check(z.regex(ELEMENT)),
        module: z.string().check(z.regex(MODULE)),
      })
    )
  ),
});

export type Discovery = z.infer<typeof DiscoverySchema>;
