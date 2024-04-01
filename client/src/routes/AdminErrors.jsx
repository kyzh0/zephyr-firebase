import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, listStationsWithErrors } from '../firebase';
import { signOut } from 'firebase/auth';

import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import IconButton from '@mui/material/IconButton';
import Modal from '@mui/material/Modal';
import Container from '@mui/material/Container';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import CloseIcon from '@mui/icons-material/Close';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';

export default function AdminErrors() {
  const [stations, setStations] = useState([]);

  useEffect(() => {
    if (stations.length) return;

    async function load() {
      const s = await listStationsWithErrors();
      if (s.length) setStations(s);
    }

    load();
  }, []);

  const navigate = useNavigate();
  function handleClose() {
    navigate('/');
  }

  async function handleSignOut() {
    try {
      await signOut(auth);
      navigate('/');
    } catch (error) {
      console.error(error);
    }
  }

  return (
    <Modal open onClose={handleClose} disableAutoFocus={true}>
      <Container component="main" maxWidth="xs" sx={{ height: '100%' }}>
        <Stack direction="column" justifyContent="center" sx={{ height: '100%' }}>
          <Stack
            direction="column"
            alignItems="center"
            sx={{ backgroundColor: 'white', padding: '24px', borderRadius: '8px' }}
          >
            <Stack direction="row" justifyContent="space-between" sx={{ width: '100%' }}>
              <Link
                variant="body2"
                underline="hover"
                sx={{ cursor: 'pointer' }}
                onClick={handleSignOut}
              >
                sign out
              </Link>
              <IconButton sx={{ p: 0 }} onClick={handleClose}>
                <CloseIcon />
              </IconButton>
            </Stack>
            <Typography component="h1" variant="h5">
              Errors
            </Typography>
            <Typography component="p" variant="subtitle2" sx={{ mb: 2 }}>
              {stations.length} errors
            </Typography>
            <Box sx={{ maxHeight: '70vh', overflowY: 'scroll' }}>
              <List disablePadding>
                {stations.length ? (
                  stations.map((station, index) => {
                    return (
                      <ListItem
                        disablePadding
                        key={index}
                        onClick={() => navigate(`../stations/${station.id}`)}
                      >
                        <ListItemButton>
                          <Stack
                            direction="row"
                            justifyContent="left"
                            alignItems="center"
                            gap="24px"
                            sx={{ width: '100%' }}
                          >
                            <Stack direction="column">
                              <Typography noWrap>{station.name}</Typography>
                              {station.isOffline && (
                                <Typography noWrap sx={{ fontSize: '10px', color: 'red' }}>
                                  Offline
                                </Typography>
                              )}
                            </Stack>
                            <Box sx={{ flex: '1 0 auto' }} />
                            <KeyboardArrowRightIcon />
                          </Stack>
                        </ListItemButton>
                      </ListItem>
                    );
                  })
                ) : (
                  <ListItem>
                    <Typography>No stations with errors.</Typography>
                  </ListItem>
                )}
              </List>
            </Box>
          </Stack>
        </Stack>
      </Container>
    </Modal>
  );
}
