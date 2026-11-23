import { Request, Response } from 'express';
import {
  ErpConfigError,
  beginConnect,
  completeCallback,
  disconnectErp,
  erpConfigFromEnv,
  forwardAsk,
  publicStatus,
  ragApiBaseFromEnv,
  sanitizeAskBody,
  type ErpConfig,
} from '../erp/erp.js';
import { erpRepository } from '../erp/store.js';

export const connectErp = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ status: 401, message: 'Unauthorized' });
  try {
    const url = await beginConnect(userId, erpRepository, erpConfigFromEnv());
    return res.json({ url });
  } catch (error) {
    if (error instanceof ErpConfigError) return res.status(503).json({ message: error.message });
    return res.status(500).json({ message: 'Could not start HIRECT sign-in.' });
  }
};

export const erpStatus = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ status: 401, message: 'Unauthorized' });
  const row = await erpRepository.findByUser(userId);
  return res.json(publicStatus(row));
};

export const disconnectErpSession = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ status: 401, message: 'Unauthorized' });
  try {
    await disconnectErp(userId, erpRepository, erpConfigFromEnv());
    return res.json(publicStatus(null));
  } catch (error) {
    if (error instanceof ErpConfigError) return res.status(503).json({ message: error.message });
    const message = error instanceof Error && error.message ? error.message : 'HIRECT could not be disconnected.';
    return res.status(502).json({ message });
  }
};

export const askErp = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ status: 401, message: 'Unauthorized' });
  const parsed = sanitizeAskBody(req.body);
  if (!parsed.ok) return res.status(400).json({ detail: parsed.message });

  const abort = new AbortController();
  const onClose = () => {
    if (!res.writableEnded) abort.abort();
  };
  res.on('close', onClose);
  try {
    let config: ErpConfig | null = null;
    try {
      config = erpConfigFromEnv();
    } catch (error) {
      if (!(error instanceof ErpConfigError)) throw error;
    }
    const result = await forwardAsk({
      userId,
      repo: erpRepository,
      config,
      ragBase: ragApiBaseFromEnv(),
      body: parsed.body,
      bypassCache: req.get('X-Bypass-Cache') === '1',
      signal: abort.signal,
    });
    if (abort.signal.aborted || res.writableEnded) return;
    res.status(result.status);
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    if (result.disconnected) res.setHeader('X-Erp-Connected', '0');
    return res.send(result.body);
  } catch (error) {
    if (abort.signal.aborted || res.writableEnded) return;
    if (error instanceof ErpConfigError) return res.status(503).json({ detail: error.message });
    return res.status(502).json({ detail: 'The assistant could not be reached.' });
  } finally {
    res.off('close', onClose);
  }
};

export const erpCallback = async (req: Request, res: Response) => {
  try {
    const result = await completeCallback(req.query as Record<string, unknown>, erpRepository, erpConfigFromEnv());
    return res.status(result.status).type('html').send(result.html);
  } catch (error) {
    if (error instanceof ErpConfigError) {
      return res.status(503).type('html').send('<p>HIRECT ERP login is not configured.</p>');
    }
    return res.status(500).type('html').send('<p>HIRECT sign-in could not be finished.</p>');
  }
};
