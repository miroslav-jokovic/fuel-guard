import { SvgXml } from 'react-native-svg';
import { useTheme } from '@/theme/ThemeProvider';
import { SILVICOM_LOGO_360_DARK_XML, SILVICOM_LOGO_360_XML } from '@/theme/silvicomLogo360';

export function SilvicomLogo360({ width = 240, height = 46 }: { width?: number; height?: number }) {
  const { isDark } = useTheme();
  return (
    <SvgXml
      xml={isDark ? SILVICOM_LOGO_360_DARK_XML : SILVICOM_LOGO_360_XML}
      width={width}
      height={height}
      accessible
      accessibilityLabel="Silvicom 360"
    />
  );
}
