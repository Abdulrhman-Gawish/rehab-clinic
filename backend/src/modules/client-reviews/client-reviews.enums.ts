// How a review is presented (the legacy website's review types, without
// video): a written quote, one picture, or several pictures. The frontend
// translates the codes like every enum.
export enum ClientReviewType {
  TEXT = 'TEXT',
  IMAGE = 'IMAGE',
  GALLERY = 'GALLERY',
}
