import { HandlerRequest } from "../notion-api/types.js";

export const getNotionToken = (c: HandlerRequest) => {
  return (
    c.env?.NOTION_TOKEN ||
    (c.req.header("Authorization") || "").split("Bearer ")[1] ||
    undefined
  );
};
