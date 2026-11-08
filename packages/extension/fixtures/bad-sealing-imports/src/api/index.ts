import { Router } from 'express';

// Plain JavaScript in a .ts file: the fixture build copies it to dist/api/index.js.
export const create = () => {
  const router = Router();
  router.get('/echo', async (req, res) => {
    const { prefix } = await import('../mcp/prefix.js');
    res.json({ success: true, data: { msg: `${prefix}${String(req.query['msg'])}` } });
  });
  return router;
};
