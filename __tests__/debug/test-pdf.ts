import { PDFDocument } from 'pdf-lib';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

async function test() {
  const s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
    region: 'us-east-1',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
      secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin',
    },
    forcePathStyle: true,
  });

  const storageKey = '34d9ef41-361e-4159-8746-e6528c4f6a2c/companies/de5bab40-6a15-4eef-8d67-15a38e0df4f5/documents/0257c58c-d54b-481f-a05c-0145b5937f28/Bank Statement_OCBC Bank_604716910001_SGD 86,670.55.pdf';

  try {
    const response = await s3.send(new GetObjectCommand({
      Bucket: process.env.S3_BUCKET || 'oakcloud',
      Key: storageKey,
    }));

    const pdfBytes = await response.Body?.transformToByteArray();
    if (!pdfBytes) throw new Error('No body');

    console.log('PDF downloaded, size:', pdfBytes.length);

    // Try pdf-lib first
    try {
      const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
      console.log('pdf-lib page count:', pdfDoc.getPageCount());
    } catch (pdfLibError: any) {
      console.error('pdf-lib failed:', pdfLibError.message);
    }

    // Try pdfjs-dist
    try {
      const pdfDoc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
      console.log('pdfjs-dist page count:', pdfDoc.numPages);

      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const viewport = page.getViewport({ scale: 1.0 });
        console.log(`Page ${i}: ${viewport.width}x${viewport.height}`);
      }
    } catch (pdfjsError: any) {
      console.error('pdfjs-dist failed:', pdfjsError.message);
    }
  } catch (error: any) {
    console.error('Error:', error.message);
    console.error(error);
  }
}
test();
