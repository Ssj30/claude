import { describe, expect, it } from "vitest";
import { parseReviewRows } from "../reviewImport";

describe("parseReviewRows", () => {
  it("reads a spreadsheet paste (tabs)", () => {
    const r = parseReviewRows("Product\tStars\tName\tReview\nporsche-911-turbo\t5\tAnna\tGreat gift");
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { handle: "porsche-911-turbo", rating: 5, author: "Anna", title: "", body: "Great gift", date: null },
    ]);
  });

  it("reads CSV with quotes and product URLs", () => {
    const r = parseReviewRows(
      'product_handle,rating,author,body,date\nhttps://www.911nights.com/products/porsche-911?variant=1,4,"Doe, J","Nice, really ""nice""",2026-09-01',
    );
    expect(r.rows[0]).toMatchObject({ handle: "porsche-911", rating: 4, author: "Doe, J", body: 'Nice, really "nice"' });
    expect(r.rows[0].date).toBe("2026-09-01T00:00:00.000Z");
  });

  it("reports missing columns and bad rows", () => {
    expect(parseReviewRows("name,text\na,b").errors[0]).toMatch(/Missing column/);
    const r = parseReviewRows("handle,rating,body\nx,7,hi\ny,5,");
    expect(r.rows).toHaveLength(0);
    expect(r.errors).toHaveLength(2);
  });
});
