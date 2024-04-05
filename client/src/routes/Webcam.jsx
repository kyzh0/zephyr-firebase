import { useContext, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getCamById, loadCamImages } from '../firebase';
import { AppContext } from '../context/AppContext';

import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import Modal from '@mui/material/Modal';
import Container from '@mui/material/Container';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Skeleton from '@mui/material/Skeleton';
import { alpha } from '@mui/material';

import 'react-responsive-carousel/lib/styles/carousel.min.css';
import './Webcam.css';
import { Carousel } from 'react-responsive-carousel';

export default function Webcam() {
  const { id } = useParams();
  const [webcam, setWebcam] = useState(null);
  const [images, setImages] = useState([]);
  const { refreshedWebcams } = useContext(AppContext);
  const [initialLoad, setInitialLoad] = useState(true);

  async function fetchData() {
    try {
      const cam = await getCamById(id);
      if (!cam) navigate('/');
      setWebcam(cam);
      if (Date.now() - cam.currentTime.seconds * 1000 >= 24 * 60 * 60 * 1000) return;

      const images = await loadCamImages(id);
      images.sort((a, b) => parseFloat(a.time.seconds) - parseFloat(b.time.seconds)); // time asc
      setImages(images);
    } catch (error) {
      console.error(error);
    }
  }

  // initial load
  useEffect(() => {
    if (!id) return;

    try {
      setInitialLoad(false);
      fetchData();
    } catch (error) {
      console.error(error);
    }
  }, [id]);

  // on refresh trigger (ignore initial load)
  useEffect(() => {
    if (!id || initialLoad || !refreshedWebcams || !refreshedWebcams.includes(id)) return;

    try {
      fetchData();
    } catch (error) {
      console.error(error);
    }
  }, [id, refreshedWebcams]);

  const navigate = useNavigate();
  function handleClose() {
    navigate('/');
  }

  const bigScreen = window.matchMedia('(min-width: 1000px)').matches;

  return (
    <Modal open onClose={handleClose} disableAutoFocus={true}>
      <Container component="main" maxWidth="xl" sx={{ height: '100%' }}>
        <Stack direction="column" justifyContent="center" sx={{ height: '100%' }}>
          <Stack
            direction="column"
            alignItems="center"
            sx={{
              backgroundColor: 'white',
              padding: '24px',
              borderRadius: '8px'
            }}
          >
            <Stack direction="row" sx={{ width: '100%' }}>
              <Stack direction="column" alignItems="center" sx={{ width: '100%', ml: 3 }}>
                {webcam ? (
                  <Typography component="h1" variant="h5" align="center">
                    {webcam.name}
                  </Typography>
                ) : (
                  <Skeleton
                    width="180px"
                    height="50px"
                    sx={{ backgroundColor: alpha('#a8a8a8', 0.1), transform: 'none' }}
                  />
                )}
              </Stack>
              <IconButton sx={{ p: 0, width: '24px', height: '24px' }} onClick={handleClose}>
                <CloseIcon />
              </IconButton>
            </Stack>
            {webcam ? (
              Date.now() - webcam.currentTime.seconds * 1000 >= 24 * 60 * 60 * 1000 ? (
                <Typography component="h1" variant="h5" sx={{ mt: 2, color: 'red' }}>
                  No images in the last 24h.
                </Typography>
              ) : images.length ? (
                <Box
                  sx={{
                    width: '80vw',
                    height: '50vw',
                    maxWidth: '800px',
                    maxHeight: bigScreen ? '480px' : '50vw'
                  }}
                >
                  <Carousel
                    showIndicators={false}
                    showThumbs={false}
                    transitionTime={0}
                    selectedItem={images.length - 1}
                    style={{ maxHeight: 'inherit', maxWidth: 'inherit' }}
                  >
                    {images.map((img) => {
                      const d = img.time.toDate();
                      return (
                        <div key={img.id}>
                          <img width="100%" src={img.url} />
                          <p
                            style={{ margin: 0 }}
                          >{`${d.getDate().toString().padStart(2, '0')} ${d.toLocaleString('default', { month: 'short' })} ${d.getFullYear()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`}</p>
                        </div>
                      );
                    })}
                  </Carousel>
                </Box>
              ) : (
                <Skeleton
                  width="100%"
                  height="40vh"
                  sx={{ backgroundColor: alpha('#a8a8a8', 0.1), transform: 'none', mb: 2, mt: 2 }}
                />
              )
            ) : (
              <Skeleton
                width="100%"
                height="40vh"
                sx={{ backgroundColor: alpha('#a8a8a8', 0.1), transform: 'none', mb: 2, mt: 2 }}
              />
            )}

            <Stack direction="row" justifyContent="end" sx={{ width: '100%' }}>
              {webcam && (
                <Link
                  href={webcam.externalLink}
                  target="_blank"
                  rel="noreferrer"
                  variant="subtitle2"
                >
                  Source: {webcam.type.charAt(0).toUpperCase() + webcam.type.slice(1)}
                </Link>
              )}
            </Stack>
          </Stack>
        </Stack>
      </Container>
    </Modal>
  );
}