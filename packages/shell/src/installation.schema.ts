import * as z from 'zod/mini';

const KEBAB = /^[a-z][a-z0-9-]*$/;
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
const Origin = z
  .string()
  .check(
    z.maxLength(270),
    z.regex(
      /^(https:\/\/[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+|http:\/\/(127\.0\.0\.1|localhost))(:[0-9]{1,5})?$/
    )
  );

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

export const EnvelopeSchema = z.object({ success: z.literal(true), data: InstallationSchema });

export type Installation = z.infer<typeof InstallationSchema>;
export type Overlay = z.infer<typeof OverlaySchema>;
export type Deployment = z.infer<typeof DeploymentSchema>;

// The slice of /.well-known/agentage-extension.json a shell reads.
export const DiscoverySchema = z.object({
  widgets: z.optional(
    z.array(
      z.object({
        name: z.string(),
        element: z.string().check(z.regex(/^[a-z][a-z0-9]*-[a-z0-9-]+$/)),
        module: z.string().check(z.regex(/^\/ui\/[^/]+\/[^/]+\.m?js$/)),
      })
    )
  ),
});

export type Discovery = z.infer<typeof DiscoverySchema>;
