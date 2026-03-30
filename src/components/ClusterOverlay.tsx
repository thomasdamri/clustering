import { Fragment, useMemo } from 'react';
import Popper from '@mui/material/Popper';
import Paper from '@mui/material/Paper';
import Popover from '@mui/material/Popover';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import type { HoveredCluster, ActiveCluster, Severity } from '../types';

interface ClusterOverlayProps {
  hoveredCluster: HoveredCluster | null;
  activeCluster: ActiveCluster | null;
  onDefectSelect: (defectId: string) => void;
  onDismiss: () => void;
}

function makeVirtualAnchor(x: number, y: number) {
  return {
    getBoundingClientRect: () =>
      DOMRect.fromRect({ x, y, width: 0, height: 0 }),
  };
}

function severitySx(severity: Severity): object {
  switch (severity) {
    case 'High': return { bgcolor: '#FFDAD6', color: '#93000A' };
    case 'Med':  return { bgcolor: '#FFE0B2', color: '#E65100' };
    case 'Low':  return { bgcolor: '#E8F5E9', color: '#1B5E20' };
  }
}

export default function ClusterOverlay({
  hoveredCluster,
  activeCluster,
  onDefectSelect,
  onDismiss,
}: ClusterOverlayProps) {
  const tooltipAnchor = useMemo(
    () =>
      hoveredCluster
        ? makeVirtualAnchor(hoveredCluster.x, hoveredCluster.y)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hoveredCluster?.x, hoveredCluster?.y],
  );

  const popoverAnchor = useMemo(
    () =>
      activeCluster
        ? makeVirtualAnchor(activeCluster.x, activeCluster.y)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeCluster?.x, activeCluster?.y],
  );

  return (
    <>
      {/* Hover tooltip — hidden when popover is open */}
      <Popper
        open={!!hoveredCluster && !activeCluster}
        anchorEl={tooltipAnchor}
        placement="right"
        modifiers={[
          {
            name: 'flip',
            enabled: true,
            options: { fallbackPlacements: ['left', 'top', 'bottom'] },
          },
          {
            name: 'offset',
            options: { offset: [0, 8] },
          },
        ]}
        sx={{ zIndex: 1500, pointerEvents: 'none' }}
      >
        <Paper
          elevation={0}
          sx={{
            px: 1,
            py: 0.5,
            bgcolor: 'rgba(50,48,51,0.92)',
            color: '#fff',
            borderRadius: 1,
            fontSize: 12,
            lineHeight: 1.4,
          }}
        >
          {hoveredCluster?.count} defect{hoveredCluster?.count !== 1 ? 's' : ''}
        </Paper>
      </Popper>

      {/* Click popover — defect list */}
      <Popover
        open={!!activeCluster}
        anchorEl={popoverAnchor}
        onClose={onDismiss}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        transformOrigin={{ vertical: 'top', horizontal: 'center' }}
        PaperProps={{
          sx: {
            width: 260,
            maxHeight: 500,
            borderRadius: 3,
            border: '0.5px solid',
            borderColor: 'divider',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          },
        }}
      >
        {/* Header */}
        <Box
          sx={{
            px: 1.5,
            py: 1,
            borderBottom: 1,
            borderColor: 'divider',
            flexShrink: 0,
          }}
        >
          <Typography
            variant="caption"
            sx={{
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'text.secondary',
              fontWeight: 500,
            }}
          >
            {activeCluster?.defects.length} Defect
            {(activeCluster?.defects.length ?? 0) > 1 ? 's' : ''}
          </Typography>
        </Box>

        {/* Defect list */}
        <List disablePadding sx={{ overflowY: 'auto', flex: 1 }}>
          {activeCluster?.defects.map((defect, i) => (
            <Fragment key={defect.defectId}>
              <ListItemButton
                onClick={() => onDefectSelect(defect.defectId)}
                sx={{ px: 1.5, py: 0.75, gap: 1, alignItems: 'center' }}
              >
                <Typography
                  component="span"
                  sx={{
                    fontFamily: 'monospace',
                    fontSize: 11,
                    color: '#21005D',
                    minWidth: 76,
                    flexShrink: 0,
                  }}
                >
                  {defect.defectId}
                </Typography>
                <Typography
                  component="span"
                  sx={{
                    fontSize: 11,
                    color: 'text.secondary',
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {defect.description}
                </Typography>
                <Chip
                  label={defect.severity}
                  size="small"
                  sx={{
                    height: 18,
                    fontSize: 10,
                    fontWeight: 600,
                    flexShrink: 0,
                    ...severitySx(defect.severity),
                  }}
                />
              </ListItemButton>
              {i < (activeCluster?.defects.length ?? 0) - 1 && (
                <Divider component="li" />
              )}
            </Fragment>
          ))}
        </List>
      </Popover>
    </>
  );
}
