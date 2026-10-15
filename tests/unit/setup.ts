import { configure } from '@testing-library/react';

// Con tutta la suite in parallelo il primo render di un file può superare il secondo
// di attesa predefinito di findBy/waitFor; resta sotto il timeout del test (5 s).
configure({ asyncUtilTimeout: 3000 });
