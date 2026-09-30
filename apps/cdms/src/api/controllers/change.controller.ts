import { NextFunction, Request, Response } from "express";
import { DatabaseClient } from "../../db/types.js";
import { ChangeRepository } from "../../repositories/change.repository.js";

export class ChangeController {
  private db: DatabaseClient;
  private changeRepo: ChangeRepository;

  constructor(db: DatabaseClient, changeRepo: ChangeRepository = new ChangeRepository()) {
    this.db = db;
    this.changeRepo = changeRepo;
  }

  public getChanges = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const productId = req.query.productId as string | undefined;
      const changes = await this.changeRepo.listChanges(this.db, productId);
      res.status(200).json({
        total: changes.length,
        changes,
      });
    } catch (err) {
      next(err);
    }
  };

  public getProductHistory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const productId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const changes = await this.changeRepo.listChanges(this.db, productId);
      res.status(200).json({
        productId,
        totalChanges: changes.length,
        changes,
      });
    } catch (err) {
      next(err);
    }
  };

  public getHealth = async (_req: Request, res: Response): Promise<void> => {
    res.status(200).json({
      status: "UP",
      service: "cdms-api",
      timestamp: new Date().toISOString(),
    });
  };

  public getReady = async (_req: Request, res: Response): Promise<void> => {
    const isDbHealthy = await this.db.isHealthy();
    if (!isDbHealthy) {
      res.status(503).json({
        status: "NOT_READY",
        db: "DISCONNECTED",
        timestamp: new Date().toISOString(),
      });
      return;
    }

    res.status(200).json({
      status: "READY",
      db: "CONNECTED",
      timestamp: new Date().toISOString(),
    });
  };
}
