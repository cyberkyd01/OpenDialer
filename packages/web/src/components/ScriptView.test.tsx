import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ScriptView } from './ScriptView';

afterEach(cleanup);

describe('ScriptView', () => {
  it('fills placeholders and renders paragraphs, bold and line breaks', () => {
    const body = 'Hi **{{first_name}}**, this is {{agent_name}} from {{company_name}}.\nHow are you?\n\nYour plan: {{custom.plan}}';
    const { container } = render(
      <ScriptView body={body} lead={{ firstName: 'Ann', lastName: 'Lee', custom: { plan: 'Gold' } }} agentName="Bob" companyName="Acme" />,
    );
    const ps = container.querySelectorAll('p');
    expect(ps).toHaveLength(2);
    expect(ps[0].querySelector('strong')?.textContent).toBe('Ann');
    expect(ps[0].querySelectorAll('br')).toHaveLength(1);
    expect(ps[0].textContent).toBe('Hi Ann, this is Bob from Acme.How are you?');
    expect(ps[1].textContent).toBe('Your plan: Gold');
  });

  it('renders headings and bullet lists, unknown placeholders are empty', () => {
    const { container } = render(<ScriptView body={'# Opening\n\n- one {{nope}}\n- **two**'} lead={null} />);
    expect(container.querySelector('h3')?.textContent).toBe('Opening');
    const lis = container.querySelectorAll('li');
    expect(lis).toHaveLength(2);
    expect(lis[0].textContent).toBe('one ');
    expect(lis[1].querySelector('strong')?.textContent).toBe('two');
  });

  it('never injects HTML from lead data', () => {
    const { container } = render(<ScriptView body="Hello {{first_name}}" lead={{ firstName: '<img src=x onerror=alert(1)>' }} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
