declare module "multer";

declare global {
  namespace Express {
    namespace Multer {
      interface File {
        fieldname: string;
        originalname: string;
        encoding: string;
        mimetype: string;
        size: number;
        buffer: Buffer;
      }
    }

    interface Request {
      files?: {
        [fieldname: string]: Multer.File[];
      };

      rawBody?: string;
    }
  }
}

export {};
