import { Router } from 'express';

// Plain JavaScript in a .ts file: the fixture build copies it to dist/api/index.js.
export const create = () => {
  const router = Router();
  router.get('/echo', (req, res) => {
    const prefix = process.env['ECHO_PREFIX'] ?? '';
    res.json({ success: true, data: { msg: `${prefix}${String(req.query['msg'])}` } });
  });
  return router;
};
