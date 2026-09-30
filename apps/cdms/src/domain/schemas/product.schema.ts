import { z } from "zod";

export const ProductSchema = z.object({
  id: z.string().min(1, "Product id must not be empty"),
  sku: z.string().optional(),
  name: z.string().optional(),
  quantity: z.coerce.number().int().nonnegative().optional(),
  price: z.coerce.number().nonnegative().optional(),
  updatedAt: z.string().refine((val) => !isNaN(Date.parse(val)), {
    message: "updatedAt must be a valid date string",
  }),
});

export const ExcelRowSchema = z.object({
  id: z.union([z.string(), z.number()]).transform((val) => String(val).trim()),
  sku: z.union([z.string(), z.number()]).optional().transform((val) => val !== undefined ? String(val).trim() : undefined),
  name: z.union([z.string(), z.number()]).optional().transform((val) => val !== undefined ? String(val).trim() : undefined),
  quantity: z.union([z.string(), z.number()]).optional().transform((val) => val !== undefined && val !== "" ? Number(val) : undefined),
  price: z.union([z.string(), z.number()]).optional().transform((val) => val !== undefined && val !== "" ? Number(val) : undefined),
  updatedAt: z.union([z.string(), z.number(), z.date()]).transform((val) => {
    if (val instanceof Date) return val.toISOString();
    if (typeof val === "number") {
      // Excel serial date to JS date
      const date = new Date((val - 25569) * 86400 * 1000);
      return date.toISOString();
    }
    return new Date(val).toISOString();
  }),
});

export type RawProductInput = z.input<typeof ProductSchema>;
export type ValidatedProduct = z.infer<typeof ProductSchema>;
export type RawExcelRow = z.input<typeof ExcelRowSchema>;
