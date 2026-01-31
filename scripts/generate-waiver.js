import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';

const outputPath = path.join(process.cwd(), 'public', 'waiver.pdf');
const doc = new PDFDocument({ margin: 50 });

doc.pipe(fs.createWriteStream(outputPath));

doc.fontSize(20).text("Drake's Charters - Release and Waiver of Liability", { align: 'center' });

doc.moveDown();

doc.fontSize(12).text('WARNING: THIS DOCUMENT IS A LEGALLY BINDING RELEASE OF LIABILITY. READ CAREFULLY BEFORE SIGNING.', { align: 'left' });

doc.moveDown();

doc.fontSize(12).text('Acknowledgment of Risks', { underline: true });

doc.fontSize(11).text('I understand that guided fishing charters involve inherent risks, including but not limited to falls, collisions, hooks and equipment, wildlife interactions, weather exposure, water hazards, and other risks that may result in injury, illness, property damage, or death. I voluntarily choose to participate and accept these risks.');

doc.moveDown();

doc.fontSize(12).text('Release and Waiver of Liability', { underline: true });

doc.fontSize(11).text('In consideration for being allowed to participate in any activities with Drake\'s Charters, I release and forever discharge Drake\'s Charters, its owners, guides, employees, contractors, and agents from any and all claims or liabilities arising out of or related to my participation, including claims resulting from negligence, to the fullest extent permitted by law.');

doc.moveDown();

doc.fontSize(12).text('Assumption of Risk', { underline: true });

doc.fontSize(11).text('I assume all risks associated with participating in charter activities, whether known or unknown, and I agree to follow all safety instructions provided by the guide.');

doc.moveDown();

doc.fontSize(12).text('Medical Consent', { underline: true });

doc.fontSize(11).text('I authorize Drake\'s Charters to obtain emergency medical treatment for me if necessary. I agree to be responsible for any medical costs incurred.');

doc.moveDown();

doc.fontSize(12).text('Compliance with Rules', { underline: true });

doc.fontSize(11).text('I agree to comply with all guide instructions, boating laws, and state fishing regulations. Failure to follow instructions may result in removal from the trip without refund.');

doc.moveDown();

doc.fontSize(12).text('Photo/Video Release (Optional)', { underline: true });

doc.fontSize(11).text('I grant permission for Drake\'s Charters to use photographs or video captured during the trip for marketing purposes unless I revoke consent in writing.');

doc.moveDown();

doc.fontSize(12).text('Signature', { underline: true });

doc.fontSize(11).text('By signing below, I acknowledge that I have read, understand, and agree to this waiver and release of liability.');

doc.moveDown();

doc.text('Participant Name: ________________________________   Date: ____________');

doc.moveDown();

doc.text('Signature: ______________________________________');

doc.moveDown();

doc.text('If participant is under 18:');

doc.text('Parent/Guardian Name: ___________________________   Date: ____________');

doc.text('Parent/Guardian Signature: _______________________');

doc.end();

console.log('Waiver PDF generated:', outputPath);
