
export type MarkdownDetailOptions = {
  newlines: boolean;
  noContent: string;
  length: number;
};

export class MarkdownDetail {
  private constructor(
    private _string: string = '',
  ) {}

  static create() {
    return new MarkdownDetail();
  }

  addSection(title: string, ...content: string[]) {
    if (!content.at(0)) return this;
    if (content.length === 0) return this;

    const titleString = `**${title}:**`;
    const padLength = titleString.length + 1;

    let lineString = titleString;
    let lineLength = padLength;
    for (const item of content) {
      lineString += ` ${item}`;
      lineLength += item.length + 1;
      if (lineLength > 80) {
        this._string += `${lineString}\n`;
        lineString = ' '.repeat(padLength);
        lineLength = padLength;
      }
    }

    this._string += `${lineString}\n`;
    return this;
  }

  addText(text: string) {
    this._string += text + '\n';
    return this;
  }

  build() {
    return this._string.trimEnd();
  }
}