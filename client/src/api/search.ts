import { api } from './client';

export interface SearchResults {
  emails: Array<{
    id: string;
    threadId: string | null;
    subject: string;
    from: string;
    fromName: string | null;
    snippet: string | null;
    receivedAt: string;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    dueDate: string | null;
  }>;
  events: Array<{
    id: string;
    title: string;
    startTime: string;
    endTime: string;
    location: string | null;
  }>;
  customers: Array<{
    id: string;
    name: string;
    company: string | null;
    email: string | null;
    logoUrl: string | null;
  }>;
  contacts: Array<{
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    role: string | null;
    customerId: string;
    customer: { name: string } | null;
  }>;
}

export const searchApi = {
  search(q: string) {
    return api.get<{ data: SearchResults }>('/search', { params: { q } });
  },
};
