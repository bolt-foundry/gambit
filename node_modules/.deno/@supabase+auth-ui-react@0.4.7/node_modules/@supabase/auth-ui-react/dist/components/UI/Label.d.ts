import React from 'react';
import { Appearance } from '../../types';
interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
    children: React.ReactNode;
    appearance?: Appearance;
}
declare const Label: React.FC<LabelProps>;
export { Label };
//# sourceMappingURL=Label.d.ts.map