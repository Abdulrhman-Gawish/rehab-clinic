import { sanitizeBlogHtml } from './blog-html.js';

describe('sanitizeBlogHtml', () => {
  it('keeps what the editor produces', () => {
    const html =
      '<h2 class="ql-align-center">عنوان</h2>' +
      '<p class="ql-align-right ql-direction-rtl ql-indent-2"><strong>a</strong> <em>b</em> <u>c</u> <s>d</s><br></p>' +
      '<ol><li class="ql-indent-1">one</li></ol><ul><li>two</li></ul>';
    expect(sanitizeBlogHtml(html)).toBe(
      '<h2 class="ql-align-center">عنوان</h2>' +
        '<p class="ql-align-right ql-direction-rtl ql-indent-2"><strong>a</strong> <em>b</em> <u>c</u> <s>d</s><br /></p>' +
        '<ol><li class="ql-indent-1">one</li></ol><ul><li>two</li></ul>',
    );
  });

  it('removes scripts, event handlers, styles and unknown tags', () => {
    expect(
      sanitizeBlogHtml(
        '<p onclick="x()" style="color:red">hi<script>alert(1)</script></p>' +
          '<img src=x onerror="alert(1)"><iframe src="https://evil.test"></iframe>' +
          '<div>text kept</div><style>p{}</style>',
      ),
    ).toBe('<p>hi</p>text kept');
  });

  it('keeps only the Quill classes, on the allowed tags', () => {
    expect(
      sanitizeBlogHtml(
        '<p class="ql-align-center evil ql-indent-99">a</p><strong class="ql-align-center">b</strong>',
      ),
    ).toBe('<p class="ql-align-center">a</p><strong>b</strong>');
  });

  it('keeps http, https and mailto links, opening in a new tab', () => {
    expect(
      sanitizeBlogHtml(
        '<a href="https://clinic.test/x" target="_self" rel="opener" title="t">a</a>' +
          '<a href=" mailto:info@clinic.test ">b</a>',
      ),
    ).toBe(
      '<a href="https://clinic.test/x" rel="noopener noreferrer" target="_blank">a</a>' +
        '<a href="mailto:info@clinic.test" rel="noopener noreferrer" target="_blank">b</a>',
    );
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'java&#x09;script:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'vbscript:x',
    '//evil.test/x',
    '/relative/path',
  ])('drops the href %s (the text stays)', (href) => {
    expect(sanitizeBlogHtml(`<p><a href="${href}">link</a></p>`)).toBe(
      '<p><a rel="noopener noreferrer" target="_blank">link</a></p>',
    );
  });

  it.each(['', '   ', '<p><br></p>', '<p> &nbsp; </p>', '<script>x</script>'])(
    'is empty when nothing readable is left: %j',
    (html) => {
      expect(sanitizeBlogHtml(html)).toBe('');
    },
  );
});
