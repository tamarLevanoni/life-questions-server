import { prisma } from '../../lib/prisma';
import { sendContactEmail } from '../../lib/resend';
import { ContactInput } from './contact.validators';

export async function createContact(data: ContactInput) {
  const contact = await prisma.contactMessage.create({
    data: {
      name:     data.name,
      email:    data.email,
      category: data.category,
      subject:  data.subject,
      message:  data.message,
      pageUrl:  data.pageUrl  ?? null,
      storyId:  data.story?.id ?? null,
    },
  });

  await sendContactEmail(data);

  return contact;
}
